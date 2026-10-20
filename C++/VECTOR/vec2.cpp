#include<iostream>
#include<vector>
using namespace std;
int main(){
  //int
  vector<int> vec = {1, 2, 3, 4, 5, 6, 7, 8};
  for (int i : vec){
    cout<<i<<", ";
  }
  cout<<endl;
  //char
  vector<char> letter = {'a',  'b', 'c', 'd', 'e'};
  for (char letter : letter){
    cout<<letter<<" ";
  }
  return 0;
}