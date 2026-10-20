#include<iostream>
using namespace std;
int main() {
  char ch;
  cout<<"Enter a letter: ";
  cin>>ch;
  if (ch >= 65 && ch < 97){
    cout<<ch<<" is a Uppercase."<<endl;
  }else {
    cout<<ch<<" is a lowercase."<<endl;
  }
  return 0;
}