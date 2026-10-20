#include<iostream>o
#include<vector>
using namespace std;
int main(){
  vector<char> letter;
  letter.push_back('a');
  letter.push_back('b');
  letter.push_back('c');
  for (char x : letter){
    cout<<"Values: "<<x;
  }
  cout<<"Size: "<<letter.size()<<endl;
  cout<<"Capacity: "<<letter.capacity()<<endl;

  return 0;
}